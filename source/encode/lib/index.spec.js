/*********************************************************************************************************************
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.                                           *
 *                                                                                                                    *
 *  Licensed under the Apache License, Version 2.0 (the "License"). You may not use this file except in compliance    *
 *  with the License. A copy of the License is located at                                                             *
 *                                                                                                                    *
 *      http://www.apache.org/licenses/LICENSE-2.0                                                                    *
 *                                                                                                                    *
 *  or in the 'license' file accompanying this file. This file is distributed on an 'AS IS' BASIS, WITHOUT WARRANTIES *
 *  OR CONDITIONS OF ANY KIND, express or implied. See the License for the specific language governing permissions    *
 *  and limitations under the License.                                                                                *
 *********************************************************************************************************************/

const expect = require('chai').expect;
const path = require('path');
const { mockClient } = require("aws-sdk-client-mock");
const { MediaConvertClient, GetJobTemplateCommand, CreateJobCommand } = require('@aws-sdk/client-mediaconvert');
const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");

const lambda = require('../index.js');

describe('#ENCODE::', () => {
    process.env.MediaConvertRole = 'Role';
    process.env.Workflow = 'vod';
    process.env.ErrorHandler = 'error_handler';

    const _event = {
        guid: '12345678',
        jobTemplate: 'jobTemplate',
        srcVideo: 'video.mp4',
        srcBucket: 'src',
        destBucket: 'dest',
        acceleratedTranscoding:'PREFERRED'
    };

    const _withframe = {
        guid: '12345678',
        jobTemplate: 'jobTemplate',
        srcVideo: 'video.mp4',
        srcBucket: 'src',
        destBucket: 'dest',
        frameCapture: true,
        acceleratedTranscoding:'ENABLED'
    };

    const data = {
        Job: {
            Id: '12345',
        }
    };

    const tmpl = {
        JobTemplate: {
            Settings: {
                OutputGroups: [
                    {
                        OutputGroupSettings: {
                            Type: 'HLS_GROUP_SETTINGS'
                        },
                        Name: 'test-output-group'
                    }
                ]
            }
        }
    };

    const mediaConvertClientMock = mockClient(MediaConvertClient);
    const lambdaClientMock = mockClient(LambdaClient);

    afterEach(() => mediaConvertClientMock.reset());

    it('should succeed when FrameCapture is disabled', async () => {
        mediaConvertClientMock.on(GetJobTemplateCommand).resolves(tmpl);
        mediaConvertClientMock.on(CreateJobCommand).resolves(data);


        const response = await lambda.handler(_event);
        expect(response.encodeJobId).to.equal('12345');
        expect(response.encodingJob.Settings.OutputGroups[0].OutputGroupSettings.Type).to.equal('HLS_GROUP_SETTINGS');
    });

    it('should succeed when FrameCapture is enabled', async () => {
        mediaConvertClientMock.on(GetJobTemplateCommand).resolves(tmpl);
        mediaConvertClientMock.on(CreateJobCommand).resolves(data);

        const response = await lambda.handler(_withframe);
        expect(response.encodeJobId).to.equal('12345');
        expect(response.encodingJob.Settings.OutputGroups[1].CustomName).to.equal('Frame Capture');
    });

    it('should write outputs under the guid when preserveFilePathInOutput is false', async () => {
        mediaConvertClientMock.on(GetJobTemplateCommand).resolves(tmpl);
        mediaConvertClientMock.on(CreateJobCommand).resolves(data);

        const response = await lambda.handler({ ..._withframe, preserveFilePathInOutput: false, destPathPreserved: 'a/b/video' });
        const groups = response.encodingJob.Settings.OutputGroups;
        expect(groups[0].OutputGroupSettings.HlsGroupSettings.Destination).to.equal('s3://dest/12345678/hls/');
        expect(groups[1].OutputGroupSettings.FileGroupSettings.Destination).to.equal('s3://dest/12345678/thumbnails/');
    });

    it('should write outputs under the preserved input path when enabled', async () => {
        mediaConvertClientMock.on(GetJobTemplateCommand).resolves(tmpl);
        mediaConvertClientMock.on(CreateJobCommand).resolves(data);

        const response = await lambda.handler({ ..._withframe, srcVideo: 'a/b/video.mp4', preserveFilePathInOutput: true, destPathPreserved: 'a/b/video' });
        const groups = response.encodingJob.Settings.OutputGroups;
        expect(groups[0].OutputGroupSettings.HlsGroupSettings.Destination).to.equal('s3://dest/a/b/video/hls/');
        expect(groups[1].OutputGroupSettings.FileGroupSettings.Destination).to.equal('s3://dest/a/b/video/thumbnails/');
        expect(groups[1].Outputs[0].VideoDescription.CodecSettings.FrameCaptureSettings.MaxCaptures).to.equal(1);
    });

    it('should fall back to the guid when preserve is on but no preserved path is set', async () => {
        mediaConvertClientMock.on(GetJobTemplateCommand).resolves(tmpl);
        mediaConvertClientMock.on(CreateJobCommand).resolves(data);

        const response = await lambda.handler({ ..._withframe, preserveFilePathInOutput: true });
        expect(response.encodingJob.Settings.OutputGroups[0].OutputGroupSettings.HlsGroupSettings.Destination).to.equal('s3://dest/12345678/hls/');
    });

    it('should write MP4 outputs from the shipped 720p template under the workflow path', async () => {
        const shipped = require('../../custom-resource/lib/mediaconvert/templates/720p_avc_aac_16x9_qvbr_no_preset.json');
        mediaConvertClientMock.on(GetJobTemplateCommand).resolves({ JobTemplate: shipped });
        mediaConvertClientMock.on(CreateJobCommand).resolves(data);

        const response = await lambda.handler({ ..._event, preserveFilePathInOutput: true, destPathPreserved: 'a/b/video' });
        const mp4 = response.encodingJob.Settings.OutputGroups.find(g => g.OutputGroupSettings.Type === 'FILE_GROUP_SETTINGS');
        expect(mp4.OutputGroupSettings.FileGroupSettings.Destination).to.equal('s3://dest/a/b/video/mp4/');
        expect(mp4.Outputs[0].AudioDescriptions[0].AudioSourceName).to.equal('Audio Selector 1');
    });

    it('should apply custom settings when template is custom', async () => {
        const event = {
            guid: '12345678',
            jobTemplate: 'custom-template',
            srcVideo: 'video.mp4',
            srcBucket: 'src',
            destBucket: 'dest',
            isCustomTemplate: true,
            acceleratedTranscoding:'DISABLED'
        };

        const customTemplate = {
            JobTemplate: {
                Name: 'custom-template',
                Type: 'CUSTOM',
                Settings: {
                    OutputGroups: [{
                        OutputGroupSettings: {
                            Type: 'HLS_GROUP_SETTINGS',
                            HlsGroupSettings: {
                                SegmentLength: 10,
                                MinSegmentLength: 2
                            }
                        },
                        Name: 'custom-output-group'
                    }]
                }
            }
        };

        const newJob = { Job: { Id: '12345678' } };

        mediaConvertClientMock.on(GetJobTemplateCommand).resolves(customTemplate);
        mediaConvertClientMock.on(CreateJobCommand).resolves(newJob);

        const response = await lambda.handler(event);

        const output = response.encodingJob.Settings.OutputGroups[0];
        const settings = output.OutputGroupSettings.HlsGroupSettings;

        expect(settings).not.to.be.null;
        expect(settings.SegmentLength).to.equal(10);
        expect(settings.MinSegmentLength).to.equal(2);
    });

    it('should fail when getJobTemplate throws an exception', async () => {
        mediaConvertClientMock.on(GetJobTemplateCommand).rejects('GET ERROR');
        lambdaClientMock.on(InvokeCommand).resolves();

        await lambda.handler(_event).catch(err => {
            expect(err.toString()).to.equal('Error: GET ERROR');
        });
    });

    it('should fail when createJob throws an exception', async () => {
        mediaConvertClientMock.on(GetJobTemplateCommand).resolves(tmpl);
        mediaConvertClientMock.on(CreateJobCommand).rejects('JOB ERROR');
        lambdaClientMock.on(InvokeCommand).resolves();

        await lambda.handler(_event).catch(err => {
            expect(err.toString()).to.equal('Error: JOB ERROR');
        });
    });
});
